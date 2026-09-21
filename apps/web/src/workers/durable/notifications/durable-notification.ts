import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import type { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { pushSubscriptionVersion, type PushSubscriptionTarget } from '@/lib/push-notifications';
import {
  readSottoWorkerJob,
  sottoJobOutbox,
  sottoJobSnapshot,
} from '@/lib/sidedoor/jobs/core/job-delivery';
import { incorporationPayloadSchema } from '@/lib/sidedoor/jobs/stitch/incorporation-work';
import { validateEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { completeErasedJob, readJobParent } from '@/lib/sidedoor/access/deletion/job-erasure';
import { readStitchingParent } from '@/lib/sidedoor/jobs/stitch/stitching-parent';
import {
  credentialValidationPayloadSchema,
  validateCredentialWorkStorage,
} from '@/lib/sidedoor/credentials/runtime/credential-validation-work';

const id = z.string().min(1).max(200);
const episodeNotificationSchema = z
  .object({
    userId: id,
    type: z.enum(['EPISODE_READY', 'EPISODE_FAILED']),
    title: z.string().min(1).max(300),
    message: z.string().min(1).max(20_000),
    data: z.object({ episodeId: id }).strict(),
    parentOperationId: z.uuid(),
    parentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    storage: incorporationPayloadSchema.shape.storage,
    contributorId: id,
  })
  .strict();

const credentialNotificationSchema = episodeNotificationSchema
  .omit({ contributorId: true })
  .extend({
    type: z.literal('KEY_INVALID'),
    data: z
      .object({
        provider: z.string().min(1),
        modality: credentialValidationPayloadSchema.shape.modality,
        revision: z.uuid(),
      })
      .strict(),
    storage: credentialValidationPayloadSchema.shape.storage,
  });
export const durableNotificationSchema = z.discriminatedUnion('type', [
  episodeNotificationSchema,
  credentialNotificationSchema,
]);

export async function validateDurableNotificationTarget(
  database: Prisma.TransactionClient,
  message: z.infer<typeof durableNotificationSchema>
) {
  if (message.type !== 'KEY_INVALID') {
    await validateEpisodeStorage(database, message.data.episodeId, message.storage, [
      message.contributorId,
    ]);
    return true;
  }
  const storage = await validateCredentialWorkStorage(database, {
    userId: message.userId,
    ...message.data,
    storage: message.storage,
  });
  const head = await storage.owned.head(storage.target);
  return (
    head.revision === message.data.revision &&
    head.credential?.availability === 'disabled' &&
    head.credential.verification.lastConfirmed?.status === 'rejected'
  );
}

export type NotificationQueueReference = { id?: string; name: string; data: unknown };

async function readAdmission(
  database: Prisma.TransactionClient,
  queued: NotificationQueueReference
) {
  const work = await readSottoWorkerJob(database, queued, {
    handler: 'notifications',
    version: 1,
    payload: durableNotificationSchema,
  });
  if (work.complete) return work;
  const { payload } = work;
  if (
    !isDeepStrictEqual(work.scopes, payload.storage.scopes) ||
    payload.userId !== payload.storage.userId
  )
    throw new Error('Notification scopes or recipient do not match admission');
  if (payload.type === 'KEY_INVALID') {
    const parent = await readJobParent(database, work, {
      id: payload.parentOperationId,
      fingerprint: payload.parentFingerprint,
      handler: 'key-validation',
      version: 1,
    });
    if (!parent) return { complete: true as const };
    const parentPayload = credentialValidationPayloadSchema.parse(parent.job.payload);
    if (
      !isDeepStrictEqual(parentPayload, {
        userId: payload.userId,
        ...payload.data,
        storage: payload.storage,
      })
    )
      throw new Error('Credential notification does not match its validation parent');
  } else {
    const parent = await readStitchingParent(
      database,
      work,
      {
        id: payload.parentOperationId,
        fingerprint: payload.parentFingerprint,
      },
      payload.type === 'EPISODE_READY' ? 'readyNotification' : 'failedNotification'
    );
    if (!parent) return { complete: true as const };
    const parentPayload = parent.source;
    if (
      parentPayload.episodeId !== payload.data.episodeId ||
      parentPayload.contributorId !== payload.contributorId ||
      !isDeepStrictEqual(parentPayload.storage, payload.storage) ||
      payload.userId !== payload.storage.userId
    ) {
      throw new Error('Notification recipient or episode does not match its parent');
    }
  }
  if (await completeErasedJob(database, work)) return { complete: true as const };
  if (!(await validateDurableNotificationTarget(database, payload))) {
    await sottoJobOutbox(database).complete(work.operationId, work.fingerprint);
    return { complete: true as const };
  }
  const user = await database.user.findUniqueOrThrow({
    where: { id: payload.userId },
    select: { pushNotifications: true },
  });
  return {
    ...work,
    optedIn: user.pushNotifications,
  };
}

/** Commit the inbox and immutable delivery work together, before any external send. */
export async function processDurableNotification(
  queued: NotificationQueueReference
): Promise<void> {
  const captured = await sottoTransaction(prisma, (tx) => readAdmission(tx, queued));
  if (captured.complete) return;
  const channels = [{ channel: 'sse' as const }];
  const deliveries = channels.map((channel) =>
    prepareJob({
      namespace: SIDEDOOR_STATE_ID,
      handler: 'notifications',
      version: 2,
      payload: {
        parentOperationId: captured.operationId,
        parentFingerprint: captured.fingerprint,
        parentVersion: 1,
        notificationId: captured.operationId,
        ...channel,
      },
      scopes: captured.scopes,
      delivery: { attempts: 5, priority: 0, availableAt: 0 },
    })
  );
  const fanout = prepareJob({
    namespace: SIDEDOOR_STATE_ID,
    handler: 'notifications',
    version: 3,
    payload: {
      parentOperationId: captured.operationId,
      parentFingerprint: captured.fingerprint,
      parentVersion: 1,
      snapshotId: captured.operationId,
      page: 0,
    },
    scopes: captured.scopes,
    delivery: { attempts: 5, priority: 0, availableAt: 0 },
  });
  await sottoTransaction(prisma, async (tx) => {
    const current = await readAdmission(tx, queued);
    if (current.complete) return;
    if (!isDeepStrictEqual(current, captured))
      throw new Error('Notification admission changed before inbox creation');
    const snapshot = sottoJobSnapshot(tx);
    await snapshot.createForJob({ id: captured.operationId, fingerprint: captured.fingerprint });
    let after: string | null = null;
    let page = 0;
    while (captured.optedIn) {
      const devices: PushSubscriptionTarget[] = await tx.pushSubscription.findMany({
        where: {
          userId: captured.payload.userId,
          ...(after === null ? {} : { id: { gt: after } }),
        },
        orderBy: { id: 'asc' },
        take: 100,
        select: { id: true, userId: true, endpoint: true, p256dh: true, auth: true },
      });
      if (!devices.length) break;
      await snapshot.append(
        captured.operationId,
        captured.fingerprint,
        page++,
        devices.map((device) => ({
          id: device.id,
          version: pushSubscriptionVersion(device),
        }))
      );
      after = devices.at(-1)!.id;
      if (devices.length < 100) break;
    }
    await snapshot.seal(captured.operationId, captured.fingerprint);
    const outbox = sottoJobOutbox(tx);
    if (!(await outbox.complete(captured.operationId, captured.fingerprint))) return;
    await tx.notification.create({
      data: {
        id: captured.operationId,
        userId: captured.payload.userId,
        type: captured.payload.type,
        title: captured.payload.title,
        message: captured.payload.message,
        data: captured.payload.data,
      },
    });
    for (const delivery of deliveries) await outbox.enqueue(delivery);
    if (page > 0) await outbox.enqueue(fanout);
  });
}
