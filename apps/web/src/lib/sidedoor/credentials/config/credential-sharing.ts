import { CredentialSharing } from 'thesidedoor-core/configuration/credential-sharing';
import { OwnedCredentials } from 'thesidedoor-core/configuration/owned-credentials';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import { sottoStorageInstance, SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';

/** Revoke instance policy with private conversion or profile deletion in the caller's transaction. */
export async function revokeSottoCredentialSharing(
  database: Prisma.TransactionClient,
  profileIds: readonly string[]
): Promise<void> {
  if (profileIds.length === 0) return;
  const instance = await sottoStorageInstance(database).read();
  const sharing = new CredentialSharing(
    { query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
    'postgres',
    SIDEDOOR_STATE_ID,
    instance.instanceId
  );
  const owners = new Set(profileIds.map((id) => `profile:${id}`));
  let cursor: string | null = null;
  do {
    const page = await sharing.list(cursor);
    for (const grant of page.items) {
      if (!owners.has(grant.policy.owner.subjectId)) continue;
      await sharing.remove({ modality: grant.modality, provider: grant.provider }, grant.revision);
    }
    cursor = page.cursor;
  } while (cursor !== null);
}

/** Remove encrypted values and policy references before the learner cascade. No decryption is needed. */
export async function eraseSottoProviderCredentials(
  database: Prisma.TransactionClient,
  userId: string
): Promise<void> {
  const user = await database.user.findUnique({
    where: { id: userId },
    select: { createdAt: true },
  });
  if (!user) throw new Error('Credential erasure requires the current learner generation');
  const owner = { subjectId: `profile:${userId}`, generation: user.createdAt.getTime() };
  const instance = await sottoStorageInstance(database).read();
  const executor = {
    query: (sql: string, values: readonly unknown[]) =>
      database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
  };
  // Metadata-only maintenance supports enumeration and removal without provider or decryption authority.
  const credentials = new OwnedCredentials(executor, 'postgres', {
    namespace: SIDEDOOR_STATE_ID,
    instanceId: instance.instanceId,
    encryptionKey: undefined,
    descriptors: () => [],
  });
  let cursor: string | null = null;
  do {
    const page = await credentials.listOwner(owner, cursor);
    for (const entry of page.items)
      await credentials.remove(
        { owner, modality: entry.modality, provider: entry.provider },
        entry.credentialRevision,
        randomUUID()
      );
    cursor = page.cursor;
  } while (cursor !== null);
  const sharing = new CredentialSharing(
    executor,
    'postgres',
    SIDEDOOR_STATE_ID,
    instance.instanceId
  );
  cursor = null;
  do {
    const page = await sharing.list(cursor);
    for (const grant of page.items) {
      const slot = { modality: grant.modality, provider: grant.provider };
      if (grant.policy.owner.subjectId === owner.subjectId) {
        await sharing.remove(slot, grant.revision);
        continue;
      }
      const excludedRecipients = grant.policy.excludedRecipients.filter(
        (recipient) =>
          recipient.subjectId !== owner.subjectId || recipient.generation !== owner.generation
      );
      if (excludedRecipients.length !== grant.policy.excludedRecipients.length)
        await sharing.set(slot, grant.revision, { ...grant.policy, excludedRecipients });
    }
    cursor = page.cursor;
  } while (cursor !== null);
}
