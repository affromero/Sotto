import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { pushSubscriptionVersion, sendPushToSubscription } from '@/lib/push-notifications';
import { publishNotification } from '@/lib/redis';
import { readSottoWorkerJob, sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { completeErasedJob, readJobParent } from '@/lib/sidedoor/access/deletion/job-erasure';
import type { NotificationQueueReference } from '@/workers/durable/notifications/durable-notification';
import { readNotificationParent } from '@/workers/durable/notifications/notification-parent';

const identity = {
  parentOperationId: z.uuid(),
  parentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  parentVersion: z.union([z.literal(1), z.literal(4)]),
  notificationId: z.uuid(),
};
const payloadSchema = z.discriminatedUnion('channel', [
  z.object({ ...identity, channel: z.literal('sse') }).strict(),
  z
    .object({
      ...identity,
      channel: z.literal('push'),
      device: z
        .object({
          id: z.string().min(1).max(200),
          version: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
    })
    .strict(),
]);

async function readDelivery(
  database: Prisma.TransactionClient,
  queued: NotificationQueueReference
) {
  const work = await readSottoWorkerJob(database, queued, {
    handler: 'notifications',
    version: 2,
    payload: payloadSchema,
  });
  if (work.complete) return work;
  const parent = await readJobParent(database, work, {
    id: work.payload.parentOperationId,
    fingerprint: work.payload.parentFingerprint,
    handler: 'notifications',
    version: work.payload.parentVersion,
  });
  if (!parent) return { complete: true as const };
  if (
    !parent?.complete ||
    parent.fingerprint !== work.payload.parentFingerprint ||
    parent.job.handler !== 'notifications' ||
    parent.job.version !== work.payload.parentVersion ||
    !isDeepStrictEqual(work.scopes, parent.job.scopes)
  )
    throw new Error('Notification delivery does not match a completed inbox operation');
  if (await completeErasedJob(database, work)) return { complete: true as const };
  const message = await readNotificationParent(database, parent);
  if (!message) {
    await sottoJobOutbox(database).complete(work.operationId, work.fingerprint);
    return { complete: true as const };
  }
  const notification = await database.notification.findUniqueOrThrow({
    where: { id: work.payload.notificationId },
  });
  if (
    notification.userId !== message.userId ||
    notification.type !== message.type ||
    notification.title !== message.title ||
    notification.message !== message.message ||
    !isDeepStrictEqual(notification.data ?? undefined, message.data)
  )
    throw new Error('Notification delivery inbox contents changed');
  if (work.payload.channel === 'sse')
    return { ...work, notification, message, subscription: null, suppressed: false };
  const user = await database.user.findUniqueOrThrow({
    where: { id: message.userId },
    select: { pushNotifications: true },
  });
  const subscription = await database.pushSubscription.findUnique({
    where: { id: work.payload.device.id },
  });
  const suppressed =
    !user.pushNotifications ||
    !subscription ||
    subscription.userId !== message.userId ||
    pushSubscriptionVersion(subscription) !== work.payload.device.version;
  return {
    ...work,
    notification,
    message,
    subscription: suppressed ? null : subscription,
    suppressed,
  };
}

/** External acceptance is at least once; each device has its own durable completion. */
export async function processDurableNotificationDelivery(
  queued: NotificationQueueReference
): Promise<void> {
  const captured = await sottoTransaction(prisma, async (tx) => {
    const work = await readDelivery(tx, queued);
    if (!work.complete && work.suppressed) {
      await sottoJobOutbox(tx).complete(work.operationId, work.fingerprint);
      return { complete: true as const };
    }
    return work;
  });
  if (captured.complete) return;
  let sent = false;
  let expired = false;
  if (captured.payload.channel === 'sse') {
    const notification = captured.notification;
    await publishNotification(notification.userId, {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      data: notification.data,
      read: notification.read,
      createdAt: notification.createdAt.toISOString(),
    });
  } else {
    if (!captured.subscription) throw new Error('Admitted push delivery has no device');
    try {
      sent =
        (await sendPushToSubscription(captured.subscription, {
          title: captured.notification.title,
          body: captured.notification.message,
          notificationId: captured.notification.id,
          data: captured.message.data,
        })) === 'delivered';
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : null;
      if (code !== 404 && code !== 410) throw error;
      expired = true;
    }
  }
  await sottoTransaction(prisma, async (tx) => {
    if (await completeErasedJob(tx, captured)) return;
    const current = await readDelivery(tx, queued);
    // Another execution can complete suppression while this request is accepted.
    // Preserve confirmed success independently of which execution wins completion.
    if (sent) {
      const updated = await tx.notification.updateMany({
        where: {
          id: captured.notification.id,
          userId: captured.message.userId,
          type: captured.message.type,
          title: captured.message.title,
          message: captured.message.message,
          data: { equals: captured.message.data },
        },
        data: { pushed: true },
      });
      if (updated.count !== 1) throw new Error('Accepted push no longer matches its inbox entry');
    }
    if (current.complete) return;
    const outbox = sottoJobOutbox(tx);
    if (!(await outbox.complete(current.operationId, current.fingerprint))) return;
    if (expired && captured.subscription) {
      const { id, userId, endpoint, p256dh, auth } = captured.subscription;
      await tx.pushSubscription.deleteMany({ where: { id, userId, endpoint, p256dh, auth } });
    }
  });
}
