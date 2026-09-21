import { randomUUID } from 'node:crypto';
import { AccessError } from 'thesidedoor-core/access';
import type { CredentialValues } from 'thesidedoor-core/ai';
import type { ProviderDescriptor } from 'thesidedoor-core/ai/browser';
import { OwnedCredentials } from 'thesidedoor-core/configuration/owned-credentials';
import {
  CredentialSharing,
  householdCredentialRecipient,
} from 'thesidedoor-core/configuration/credential-sharing';
import {
  providerCredentials,
  providerIdentity,
  type ProviderModality,
} from 'thesidedoor-core/providers/catalog';
import { StorageWriteJournal } from 'thesidedoor-core/storage';
import type { Prisma } from '@/generated/prisma/client';
import type { AuthenticatedRequest } from '@/lib/api-keys';
import { deriveOwnedCredentialKey } from '@/lib/credentials/byok-crypto';
import { sttUsesTtsCredentials, type SttProviderId } from '@/lib/providers/stt-registry';
import type { CredentialScope } from '@/lib/sidedoor/access/state/state';
import {
  sidedoorStateStore,
  SIDEDOOR_STATE_ID,
  sottoStorageInstance,
} from '@/lib/sidedoor/access/state/store';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';

function credentialModality(scope: CredentialScope, provider: string): ProviderModality {
  if (scope === 'storage') return 'storage';
  if (scope === 'stt') return 'transcription';
  if (scope === 'tts') return 'speech';
  if (scope === 'ai')
    return providerIdentity(provider).modalities.includes('text') ? 'text' : 'transcription';
  return scope;
}

/** Transcription keeps using the same stored key as its existing AI or TTS integration. */
export function sottoCredentialSlot(scope: CredentialScope, provider: string) {
  const modality =
    scope === 'stt' ? (sttUsesTtsCredentials(provider as SttProviderId) ? 'tts' : 'ai') : scope;
  const selected = credentialModality(scope, provider);
  providerCredentials(provider, selected);
  return { modality, provider };
}

export function sottoCredentialDescriptor(
  scope: CredentialScope,
  provider: string
): ProviderDescriptor {
  const selected = credentialModality(scope, provider);
  const metadata = providerCredentials(provider, selected);
  return {
    id: provider,
    label: providerIdentity(provider).label,
    transport: 'api',
    models: [],
    capabilities:
      selected === 'music' ||
      selected === 'visual' ||
      selected === 'storage' ||
      selected === 'pricing'
        ? []
        : [selected],
    fields: [...metadata.fields, ...metadata.configurationFields],
  };
}

/** Low-level composition for authorized runtime transactions. */
export async function sottoCredentialStorage(
  database: Prisma.TransactionClient,
  scope: CredentialScope,
  provider: string
) {
  const capturedDescriptor = sottoCredentialDescriptor(scope, provider);
  return {
    ...(await sottoCredentialRows(database, [capturedDescriptor])),
    slot: sottoCredentialSlot(scope, provider),
  };
}

/** Metadata-only scans do not need provider secrets. Resolution requires explicit descriptors. */
export async function sottoCredentialRows(
  database: Prisma.TransactionClient,
  descriptors: readonly ProviderDescriptor[] = []
) {
  const capturedDescriptors = structuredClone(descriptors);
  const isolation = await database.$queryRawUnsafe<{ isolation: string }[]>(
    "SELECT current_setting('transaction_isolation') AS isolation"
  );
  if (isolation[0]?.isolation !== 'serializable')
    throw new Error('Provider credentials require a Serializable transaction');
  const instance = await sottoStorageInstance(database).read();
  const executor = {
    query: (sql: string, values: readonly unknown[]) =>
      database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
  };
  const writes = new StorageWriteJournal(executor, 'postgres', SIDEDOOR_STATE_ID);
  if (await writes.tombstone(instance.subjectId))
    throw new AccessError('conflict', 'The instance is being erased');
  return {
    instance,
    owned: new OwnedCredentials(executor, 'postgres', {
      namespace: SIDEDOOR_STATE_ID,
      instanceId: instance.instanceId,
      encryptionKey: deriveOwnedCredentialKey,
      descriptors: () => capturedDescriptors,
    }),
    sharing: new CredentialSharing(executor, 'postgres', SIDEDOOR_STATE_ID, instance.instanceId),
    writes,
  };
}

/** Existence and erasure checks only. Callers separately establish own-key or sharing authority. */
export async function captureSottoCredentialOwner(
  database: Prisma.TransactionClient,
  userId: string
) {
  const user = await database.user.findUnique({
    where: { id: userId },
    select: { id: true, createdAt: true },
  });
  if (!user) throw new AccessError('conflict', 'The credential owner no longer exists');
  const envelope = await sidedoorStateStore(database).read();
  if (
    !envelope.access.principals.some((principal) => principal.id === userId) &&
    !envelope.access.householdProfiles?.some((profile) => profile.id === userId)
  )
    throw new AccessError('forbidden');
  const owner = { subjectId: `profile:${user.id}`, generation: user.createdAt.getTime() };
  const writes = new StorageWriteJournal(
    { query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
    'postgres',
    SIDEDOOR_STATE_ID
  );
  if (await writes.tombstone(owner.subjectId))
    throw new AccessError('conflict', 'The credential owner is being erased');
  return owner;
}

/** Resolve key, auxiliary fields and provenance from one admitted transaction snapshot. */
export async function resolveSottoRequestCredential(
  database: Prisma.TransactionClient,
  request: Request,
  expected: AuthenticatedRequest,
  scope: CredentialScope,
  provider: string
) {
  await requireOriginalSottoAdmission(database, request, expected);
  return resolveSottoProfileCredential(
    database,
    expected.userId,
    scope,
    provider,
    scope !== 'visual'
  );
}

/** Internal server use after authorizing the profile or durable job. Returns one atomic credential selection. */
export async function resolveSottoProfileCredential(
  database: Prisma.TransactionClient,
  userId: string,
  scope: CredentialScope,
  provider: string,
  allowSharing: boolean
) {
  const selected = await inspectSottoProfileCredential(
    database,
    userId,
    scope,
    provider,
    allowSharing
  );
  if (!selected) return null;
  if (selected.credential.availability !== 'enabled')
    throw new AccessError('conflict', 'Selected credential is disabled');
  const storage = await sottoCredentialStorage(database, scope, provider);
  const credential = await storage.owned.resolve(
    { ...storage.slot, owner: selected.credential.owner },
    selected.credential.credentialRevision
  );
  if (!credential) throw new AccessError('conflict', 'The selected credential is unavailable');
  return { ...selected, credential };
}

/** Resolve the instance-owned storage credential selected by shared configuration. */
export async function resolveSottoInstanceStorageCredential(
  database: Prisma.TransactionClient,
  provider: 'r2' | 's3'
) {
  const storage = await sottoCredentialStorage(database, 'storage', provider);
  const owner = {
    subjectId: storage.instance.subjectId,
    generation: storage.instance.generation,
  };
  const head = await storage.owned.head({ ...storage.slot, owner });
  if (!head.credential)
    throw new AccessError('conflict', `No instance credential is configured for ${provider}`);
  if (head.credential.availability !== 'enabled')
    throw new AccessError('conflict', `The ${provider} storage credential is disabled`);
  const credential = await storage.owned.resolve(
    { ...storage.slot, owner },
    head.credential.credentialRevision
  );
  if (!credential)
    throw new AccessError('conflict', `The ${provider} storage credential is unavailable`);
  return credential;
}

/** Resolve the immutable credential revision captured by a storage descriptor. */
export async function resolveSottoInstanceStorageCredentialRevision(
  database: Prisma.TransactionClient,
  provider: 'r2' | 's3',
  credentialRevision: string
) {
  const storage = await sottoCredentialStorage(database, 'storage', provider);
  const owner = {
    subjectId: storage.instance.subjectId,
    generation: storage.instance.generation,
  };
  const credential = await storage.owned.resolve({ ...storage.slot, owner }, credentialRevision);
  if (!credential)
    throw new AccessError('conflict', `The captured ${provider} storage credential is unavailable`);
  return credential;
}

/** Resolve another instance-owned service credential without profile sharing. */
export async function resolveSottoInstanceCredential(
  database: Prisma.TransactionClient,
  scope: Extract<CredentialScope, 'pricing'>,
  provider: string
) {
  const storage = await sottoCredentialStorage(database, scope, provider);
  const owner = {
    subjectId: storage.instance.subjectId,
    generation: storage.instance.generation,
  };
  const head = await storage.owned.head({ ...storage.slot, owner });
  if (!head.credential || head.credential.availability !== 'enabled') return null;
  return storage.owned.resolve({ ...storage.slot, owner }, head.credential.credentialRevision);
}

/** Replace an instance storage credential in the caller's authorized Serializable transaction. */
export async function setSottoInstanceStorageCredential(
  database: Prisma.TransactionClient,
  provider: 'r2' | 's3',
  values: CredentialValues,
  endpoint: string
) {
  const storage = await sottoCredentialStorage(database, 'storage', provider);
  const owner = {
    subjectId: storage.instance.subjectId,
    generation: storage.instance.generation,
  };
  const target = { ...storage.slot, owner };
  const current = await storage.owned.head(target);
  const now = Date.now();
  await storage.owned.replace(
    storage.owned.prepareReplacement(target, {
      expectedHeadRevision: current.revision,
      credentialRevision: randomUUID(),
      values,
      binding: { protocol: 's3', endpoint },
      availability: 'enabled',
      label: `${provider.toUpperCase()} instance storage`,
      metadata: {
        createdAt: current.credential?.metadata.createdAt ?? now,
        updatedAt: now,
        lastUsedAt: current.credential?.metadata.lastUsedAt ?? null,
      },
    })
  );
}

/** Authorized profile metadata only. Disabled personal credentials still shadow shared credentials. */
export async function inspectSottoProfileCredential(
  database: Prisma.TransactionClient,
  userId: string,
  scope: CredentialScope,
  provider: string,
  allowSharing: boolean
) {
  const envelope = await sidedoorStateStore(database).read();
  const storage = await sottoCredentialStorage(database, scope, provider);
  const recipient = await captureSottoCredentialOwner(database, userId);
  const target = { ...storage.slot, owner: recipient };
  const own = await storage.owned.head(target);
  if (own.credential) {
    return {
      shared: false,
      ownerUserId: userId,
      credential: own.credential,
      instanceId: storage.instance.instanceId,
      sharingRevision: null,
    };
  }
  if (!allowSharing || !envelope.access.householdProfiles?.some((profile) => profile.id === userId))
    return null;
  const grant = await storage.sharing.head(storage.slot);
  if (!grant.policy || !householdCredentialRecipient(grant.policy, recipient)) return null;
  const ownerUserId = grant.policy.owner.subjectId.startsWith('profile:')
    ? grant.policy.owner.subjectId.slice('profile:'.length)
    : null;
  if (!ownerUserId) throw new AccessError('conflict', 'Shared credential owner is invalid');
  const owner = await captureSottoCredentialOwner(database, ownerUserId);
  if (owner.generation !== grant.policy.owner.generation)
    throw new AccessError('conflict', 'Shared credential owner changed');
  const { credential } = await storage.owned.head({ ...storage.slot, owner });
  if (!credential) throw new AccessError('conflict', 'The shared credential is unavailable');
  return {
    shared: true,
    ownerUserId,
    credential,
    instanceId: storage.instance.instanceId,
    sharingRevision: grant.revision,
  };
}

/** Internal listing after profile authorization. Physical slots keep STT attached to its AI/TTS key. */
export async function listSottoProfileCredentials(
  database: Prisma.TransactionClient,
  userId: string,
  scopes: readonly Exclude<CredentialScope, 'stt'>[],
  allowSharing: boolean
) {
  const selectedScopes = new Set(scopes);
  const state = await sidedoorStateStore(database).read();
  const storage = await sottoCredentialRows(database);
  const owner = await captureSottoCredentialOwner(database, userId);
  const slots = new Map<string, { scope: Exclude<CredentialScope, 'stt'>; provider: string }>();
  function retain(modality: string, provider: string) {
    for (const scope of selectedScopes) {
      if (scope !== modality) continue;
      slots.set(JSON.stringify([scope, provider]), { scope, provider });
    }
  }
  let cursor: string | null = null;
  do {
    const page = await storage.owned.listOwner(owner, cursor, 100);
    for (const item of page.items) retain(item.modality, item.provider);
    cursor = page.cursor;
  } while (cursor !== null);
  if (allowSharing && state.access.householdProfiles?.some((profile) => profile.id === userId)) {
    do {
      const page = await storage.sharing.list(cursor, 100);
      for (const item of page.items) {
        if (!householdCredentialRecipient(item.policy, owner)) continue;
        retain(item.modality, item.provider);
      }
      cursor = page.cursor;
    } while (cursor !== null);
  }
  const result = [];
  for (const { scope, provider } of slots.values()) {
    const selected = await inspectSottoProfileCredential(
      database,
      userId,
      scope,
      provider,
      allowSharing
    );
    if (selected) result.push(selected);
  }
  return result;
}
