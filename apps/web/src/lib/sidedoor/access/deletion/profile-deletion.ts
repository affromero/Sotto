import {
  AccessError,
  HouseholdProfileManagement,
  type ProfileManagerCredential,
} from 'thesidedoor-core/access';
import { cookieValue } from 'thesidedoor-core/access/http';
import { StorageCleanupJournal } from 'thesidedoor-core/storage';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { logger } from '@/lib/logger';
import { captureStorageBackend } from '@/lib/r2';
import { sottoAccessStore } from '@/lib/sidedoor/access/core/access-store';
import { sottoDeviceService } from '@/lib/sidedoor/access/state/device-identity';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';
import { sharedAccess } from '@/lib/sidedoor/access/core/service';
import { SHARED_SESSION_COOKIE } from '@/lib/sidedoor/access/core/session-identity';
import { SIDEDOOR_STATE_ID, sidedoorStateStore } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { eraseSottoProviderCredentials } from '@/lib/sidedoor/credentials/config/credential-sharing';
import { admitLearningStorageDeletion } from '@/lib/sidedoor/access/deletion/learning-deletion';
import { runSottoStorageCleanup } from '@/lib/sidedoor/storage/migration/storage-cleanup-runtime';

function cleanup(database: Prisma.TransactionClient) {
  return new StorageCleanupJournal(
    {
      query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
    },
    'postgres',
    SIDEDOOR_STATE_ID
  );
}
async function recoverCleanup(
  database: Prisma.TransactionClient,
  subjectId: string,
  generation: number
) {
  const journal = cleanup(database);
  let cursor: string | null = null;
  do {
    const page = await journal.listJobs(cursor);
    const found = page.jobs.find(
      (job) => job.subjectId === subjectId && job.generation === generation
    );
    if (found) return found;
    cursor = page.cursor;
  } while (cursor !== null);
  return null;
}
function management() {
  return new HouseholdProfileManagement(sharedAccess, {
    allowHouseholdManagement: true,
    devices: sottoDeviceService(sharedAccess),
    requiredDeviceScopes: ['app'],
    ownerDeviceScope: 'owner',
  });
}
async function admission(database: Prisma.TransactionClient, request: Request) {
  const identity = await resolveSottoRequest(database, request);
  if (!identity) throw new AccessError('unauthorized');
  const credential: ProfileManagerCredential =
    identity.authentication === 'device'
      ? { kind: 'device', token: request.headers.get('authorization')!.slice(7) }
      : { kind: 'session', token: cookieValue(request, SHARED_SESSION_COOKIE)! };
  // Both reads share one Serializable snapshot and the same canonical access checks.
  const envelope = await sidedoorStateStore(database).read();
  envelope.access = await (await sottoAccessStore(database)).read();
  return { identity, credential, envelope };
}

/** Revoke authority and persist the complete cleanup snapshot before cascading learner data. */
export async function deleteSottoProfile(database: PrismaClient, request: Request, id: string) {
  const captured = await sottoTransaction(
    database,
    async (tx) => {
      const { identity, credential, envelope } = await admission(tx, request);
      const user = await tx.user.findUnique({ where: { id }, select: { createdAt: true } });
      if (!user) return null;
      const profile = envelope.access.householdProfiles?.find((item) => item.id === id);
      if (!profile) throw new AccessError('forbidden');
      management().prepareRemove(id, profile.epoch, true).apply(envelope.access, credential);
      return {
        epoch: profile.epoch,
        generation: user.createdAt.getTime(),
        selected: identity.kind === 'content' && identity.userId === id,
      };
    },
    { signal: request.signal }
  );
  if (!captured) return null;
  const backend = await captureStorageBackend();
  const removal = management().prepareRemove(id, captured.epoch, true);
  let job: { id: string };
  try {
    job = await sottoTransaction(
      database,
      async (tx) => {
        const { credential, envelope } = await admission(tx, request);
        const user = await tx.user.findUnique({ where: { id }, select: { createdAt: true } });
        if (!user || user.createdAt.getTime() !== captured.generation)
          throw new AccessError('conflict');
        removal.apply(envelope.access, credential);
        const [prepared] = await admitLearningStorageDeletion({
          database: tx,
          scope: { kind: 'profile', id },
          subjects: [{ subjectId: `profile:${id}`, generation: captured.generation }],
          currentBackend: backend,
        });
        if (!prepared) throw new Error('Profile cleanup admission failed');
        const revision = envelope.revision;
        envelope.revision++;
        await sidedoorStateStore(tx).transact((current) => {
          if (current.revision !== revision) throw new AccessError('conflict');
          Object.assign(current, envelope);
        });
        await tx.discovery.deleteMany({ where: { userId: id } });
        await tx.apiUsageLog.deleteMany({ where: { userId: id } });
        await tx.feedback.deleteMany({ where: { userId: id } });
        await eraseSottoProviderCredentials(tx, id);
        await tx.user.delete({ where: { id }, select: { id: true } });
        return prepared;
      },
      { signal: request.signal, timeoutMs: 60_000 }
    );
  } catch (error) {
    const recovered = await sottoTransaction(database, async (tx) => {
      const identity = await resolveSottoRequest(tx, request);
      if (!identity) return null;
      return recoverCleanup(tx, `profile:${id}`, captured.generation);
    });
    if (!recovered) throw error;
    job = recovered;
  }
  try {
    await runSottoStorageCleanup(database, job.id);
  } catch (error) {
    logger.error('Profile storage cleanup remains pending', {
      profileId: id,
      jobId: job.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const status = await sottoTransaction(database, (tx) => cleanup(tx).get(job.id));
  return { id: status.id, phase: status.phase, clearSelection: captured.selected };
}
