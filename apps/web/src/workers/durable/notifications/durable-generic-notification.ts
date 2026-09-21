import { isDeepStrictEqual } from 'node:util';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import type { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { pushSubscriptionVersion, type PushSubscriptionTarget } from '@/lib/push-notifications';
import {
  durableEnvelopeSchema,
  validateDurableAuthority,
} from '@/lib/sidedoor/jobs/core/durable-queue';
import {
  readSottoWorkerJob,
  sottoJobOutbox,
  sottoJobSnapshot,
} from '@/lib/sidedoor/jobs/core/job-delivery';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { genericNotificationPayloadSchema } from '@/workers/durable/notifications/notification-parent';
import type { NotificationQueueReference } from '@/workers/durable/notifications/durable-notification';

async function readAdmission(
  database: Prisma.TransactionClient,
  queued: NotificationQueueReference
) {
  const work = await readSottoWorkerJob(database, queued, {
    handler: 'notifications',
    version: 4,
    payload: durableEnvelopeSchema,
  });
  if (work.complete) return work;
  if (work.payload.type !== 'send_notification')
    throw new Error('Unsupported durable notification operation');
  const message = genericNotificationPayloadSchema.parse(work.payload.payload);
  const recipient = await validateDurableAuthority(database, work.payload.authority);
  if (!recipient || recipient.userId !== message.userId)
    throw new Error('Durable notification recipient changed');
  const user = await database.user.findUniqueOrThrow({
    where: { id: message.userId },
    select: { pushNotifications: true },
  });
  return { ...work, message, optedIn: user.pushNotifications };
}

export async function processDurableGenericNotification(
  queued: NotificationQueueReference
): Promise<void> {
  const captured = await sottoTransaction(prisma, (database) => readAdmission(database, queued));
  if (captured.complete) return;
  const sse = prepareJob({
    namespace: SIDEDOOR_STATE_ID,
    handler: 'notifications',
    version: 2,
    payload: {
      parentOperationId: captured.operationId,
      parentFingerprint: captured.fingerprint,
      parentVersion: 4,
      notificationId: captured.message.notificationId,
      channel: 'sse',
    },
    scopes: captured.scopes,
    delivery: { attempts: 5, priority: 0, availableAt: 0 },
  });
  const fanout = prepareJob({
    namespace: SIDEDOOR_STATE_ID,
    handler: 'notifications',
    version: 3,
    payload: {
      parentOperationId: captured.operationId,
      parentFingerprint: captured.fingerprint,
      parentVersion: 4,
      snapshotId: captured.operationId,
      page: 0,
    },
    scopes: captured.scopes,
    delivery: { attempts: 5, priority: 0, availableAt: 0 },
  });
  await sottoTransaction(prisma, async (database) => {
    const current = await readAdmission(database, queued);
    if (current.complete) return;
    if (!isDeepStrictEqual(current, captured))
      throw new Error('Durable notification admission changed');
    const snapshot = sottoJobSnapshot(database);
    await snapshot.createForJob({ id: captured.operationId, fingerprint: captured.fingerprint });
    let after: string | null = null;
    let page = 0;
    while (captured.optedIn) {
      const devices: PushSubscriptionTarget[] = await database.pushSubscription.findMany({
        where: {
          userId: captured.message.userId,
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
        devices.map((device) => ({ id: device.id, version: pushSubscriptionVersion(device) }))
      );
      after = devices.at(-1)!.id;
      if (devices.length < 100) break;
    }
    await snapshot.seal(captured.operationId, captured.fingerprint);
    const outbox = sottoJobOutbox(database);
    if (!(await outbox.complete(captured.operationId, captured.fingerprint))) return;
    await database.notification.create({
      data: {
        id: captured.message.notificationId,
        userId: captured.message.userId,
        type: captured.message.type,
        title: captured.message.title,
        message: captured.message.message,
        data: captured.message.data,
      },
    });
    await outbox.enqueue(sse);
    if (page > 0) await outbox.enqueue(fanout);
  });
}
