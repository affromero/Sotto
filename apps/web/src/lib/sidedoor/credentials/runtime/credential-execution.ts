import { isDeepStrictEqual } from 'node:util';
import { AccessError } from 'thesidedoor-core/access';
import type { Prisma } from '@/generated/prisma/client';
import { captureConfiguredSottoCredentialDestination } from '@/lib/providers/shared/credential-validation';
import {
  captureSottoCredentialOwner,
  inspectSottoProfileCredential,
  listSottoProfileCredentials,
  resolveSottoProfileCredential,
  sottoCredentialStorage,
  sottoCredentialSlot,
} from '@/lib/sidedoor/credentials/runtime/provider-credentials';
import type { CredentialScope } from '@/lib/sidedoor/access/state/state';

/** The callback must revalidate the original request or durable job in this transaction. */
export type CredentialExecutionAuthority = (
  database: Prisma.TransactionClient
) => Promise<{ userId: string }>;

async function executionDestinations(
  database: Prisma.TransactionClient,
  scope: CredentialScope,
  provider: string
) {
  const invocation = await captureConfiguredSottoCredentialDestination(database, scope, provider);
  const slot = sottoCredentialSlot(scope, provider);
  const physical =
    slot.modality === scope
      ? invocation
      : await captureConfiguredSottoCredentialDestination(database, slot.modality, provider);
  if (invocation.kind === 'unsupported' || physical.kind === 'unsupported')
    throw new AccessError('invalid', 'The selected provider has no credential transport');
  return { invocation: invocation.binding, physical: physical.binding };
}

function credentialIdentity(
  selected: NonNullable<Awaited<ReturnType<typeof inspectSottoProfileCredential>>>
) {
  return {
    instanceId: selected.instanceId,
    ownerUserId: selected.ownerUserId,
    shared: selected.shared,
    sharingRevision: selected.sharingRevision,
    slot: { modality: selected.credential.modality, provider: selected.credential.provider },
    owner: selected.credential.owner,
    revision: selected.credential.credentialRevision,
    destination: selected.credential.binding,
  };
}

function freezeSnapshot<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeSnapshot(child);
    Object.freeze(value);
  }
  return value;
}

/** Capture the credential and both physical-slot and invocation transport contracts together. */
export async function captureSottoExecutionCredential(
  database: Prisma.TransactionClient,
  authorize: CredentialExecutionAuthority,
  scope: CredentialScope,
  provider: string,
  allowSharing: boolean,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  const recipient = await authorize(database);
  const recipientOwner = await captureSottoCredentialOwner(database, recipient.userId);
  const selected = await resolveSottoProfileCredential(
    database,
    recipient.userId,
    scope,
    provider,
    allowSharing
  );
  signal?.throwIfAborted();
  if (!selected) return null;
  const destinations = await executionDestinations(database, scope, provider);
  if (!isDeepStrictEqual(destinations.physical, selected.credential.binding))
    throw new AccessError('conflict', 'The credential endpoint changed; review the saved key');
  return freezeSnapshot(
    structuredClone({
      recipient: { userId: recipient.userId, owner: recipientOwner },
      scope,
      provider,
      allowSharing,
      binding: destinations.invocation,
      selected,
    })
  );
}

export type SottoExecutionCredential = NonNullable<
  Awaited<ReturnType<typeof captureSottoExecutionCredential>>
>;

/** Select and capture one enabled credential without recording use before dispatch admission. */
export async function capturePreferredSottoExecutionCredential(
  database: Prisma.TransactionClient,
  authorize: CredentialExecutionAuthority,
  scope: Exclude<CredentialScope, 'stt'>,
  allowSharing: boolean,
  preferredProvider?: string,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  const recipient = await authorize(database);
  const available = (
    await listSottoProfileCredentials(database, recipient.userId, [scope], allowSharing)
  ).filter((candidate) => candidate.credential.availability === 'enabled');
  const personal = available.filter((candidate) => !candidate.shared);
  const candidates = personal.length ? personal : available;
  candidates.sort(
    (left, right) => left.credential.metadata.createdAt - right.credential.metadata.createdAt
  );
  const provider = (
    candidates.find((candidate) => candidate.credential.provider === preferredProvider) ??
    candidates[0]
  )?.credential.provider;
  if (!provider) return null;
  return captureSottoExecutionCredential(
    database,
    authorize,
    scope,
    provider,
    allowSharing,
    signal
  );
}

export function sottoExecutionCredentialFields(captured: SottoExecutionCredential) {
  const { apiKey, ...fields } = captured.selected.credential.values;
  if (typeof apiKey !== 'string' || !apiKey.trim())
    throw new AccessError('invalid', 'The selected credential has no API key');
  return {
    apiKey,
    extraData: Object.fromEntries(
      Object.entries(fields).map(([field, value]) => [field, String(value)])
    ),
  };
}

/** Call after waits, immediately before transport execution. Never resolve a replacement key here. */
export async function validateSottoExecutionCredential(
  database: Prisma.TransactionClient,
  authorize: CredentialExecutionAuthority,
  captured: SottoExecutionCredential,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  const recipient = await authorize(database);
  const recipientOwner = await captureSottoCredentialOwner(database, recipient.userId);
  if (
    recipient.userId !== captured.recipient.userId ||
    !isDeepStrictEqual(recipientOwner, captured.recipient.owner)
  )
    throw new AccessError('conflict', 'The credential recipient changed');
  const current = await inspectSottoProfileCredential(
    database,
    recipient.userId,
    captured.scope,
    captured.provider,
    captured.allowSharing
  );
  const sameCredential =
    current?.credential.availability === 'enabled' &&
    isDeepStrictEqual(credentialIdentity(current), credentialIdentity(captured.selected));
  if (!sameCredential)
    throw new AccessError('conflict', 'The selected credential or endpoint changed');
  const destinations = await executionDestinations(database, captured.scope, captured.provider);
  if (
    !isDeepStrictEqual(destinations.physical, captured.selected.credential.binding) ||
    !isDeepStrictEqual(destinations.invocation, captured.binding)
  )
    throw new AccessError('conflict', 'The selected credential or endpoint changed');
  signal?.throwIfAborted();
}

/** Provider requests record use only after the same metadata admission used by media downloads. */
export async function admitSottoExecutionCredential(
  database: Prisma.TransactionClient,
  authorize: CredentialExecutionAuthority,
  captured: SottoExecutionCredential,
  usedAt: number,
  signal?: AbortSignal
) {
  await validateSottoExecutionCredential(database, authorize, captured, signal);
  const expected = captured.selected;
  const storage = await sottoCredentialStorage(database, captured.scope, captured.provider);
  const result = await storage.owned.recordUse(
    { ...storage.slot, owner: expected.credential.owner },
    expected.credential.credentialRevision,
    usedAt
  );
  if (result === 'superseded') throw new AccessError('conflict', 'The selected credential changed');
  signal?.throwIfAborted();
}
