import { logger } from './logger';
import { prisma } from './prisma';
import { createHash } from 'node:crypto';

export interface PushDeliveryResult {
  status: 'disabled' | 'no-subscriptions' | 'attempted';
  sent: number;
  failed: number;
  expired: number;
  deliveries: Array<{
    subscriptionId: string;
    version: string;
    status: 'delivered' | 'expired' | 'retry';
  }>;
}

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT;
let pushTransport: Promise<typeof import('web-push')> | undefined;

export interface PushSubscriptionTarget {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushMessage {
  title: string;
  body: string;
  url?: string;
  data?: Record<string, string>;
  notificationId?: string;
}

export function pushSubscriptionVersion(subscription: PushSubscriptionTarget): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        subscription.userId,
        subscription.endpoint,
        subscription.p256dh,
        subscription.auth,
      ])
    )
    .digest('hex');
}

/** Send to one captured device. The caller owns retry and expiration persistence. */
export async function sendPushToSubscription(
  subscription: PushSubscriptionTarget,
  message: PushMessage
): Promise<'delivered' | 'disabled'> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) return 'disabled';
  pushTransport ??= import('web-push').catch((error: unknown) => {
    pushTransport = undefined;
    throw error;
  });
  const webpush = await pushTransport;
  await webpush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    },
    JSON.stringify({
      title: message.title,
      body: message.body,
      url: message.url || '/',
      data: message.data,
      notificationId: message.notificationId,
    }),
    {
      timeout: 15_000,
      vapidDetails: {
        subject: VAPID_SUBJECT,
        publicKey: VAPID_PUBLIC_KEY,
        privateKey: VAPID_PRIVATE_KEY,
      },
    }
  );
  return 'delivered';
}

/**
 * Send a push notification to all of a user's registered devices
 */
export async function sendPushNotification(
  params: PushMessage & {
    userId: string;
  }
): Promise<PushDeliveryResult> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    logger.warn('VAPID keys and subject not configured — push notifications disabled');
    return { status: 'disabled', sent: 0, failed: 0, expired: 0, deliveries: [] };
  }

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId: params.userId },
  });

  if (subscriptions.length === 0) {
    logger.debug('No push subscriptions for user', { userId: params.userId });
    return { status: 'no-subscriptions', sent: 0, failed: 0, expired: 0, deliveries: [] };
  }

  const results = await Promise.allSettled(
    subscriptions.map((sub) => sendPushToSubscription(sub, params))
  );

  const deliveries: PushDeliveryResult['deliveries'] = results.map((result, index) => {
    const subscription = subscriptions[index]!;
    const statusCode =
      result.status === 'rejected'
        ? (result.reason as { statusCode?: number })?.statusCode
        : undefined;
    return {
      subscriptionId: subscription.id,
      version: pushSubscriptionVersion(subscription),
      status:
        result.status === 'fulfilled'
          ? 'delivered'
          : statusCode === 404 || statusCode === 410
            ? 'expired'
            : 'retry',
    };
  });
  const expiredSubscriptions = deliveries.flatMap((delivery, index) =>
    delivery.status === 'expired' ? [subscriptions[index]!] : []
  );

  if (expiredSubscriptions.length > 0) {
    const removed = await prisma.pushSubscription.deleteMany({
      where: {
        OR: expiredSubscriptions.map(({ id, endpoint, p256dh, auth }) => ({
          id,
          userId: params.userId,
          endpoint,
          p256dh,
          auth,
        })),
      },
    });
    logger.info('Cleaned up expired push subscriptions', { count: String(removed.count) });
  }
  const sent = deliveries.filter((delivery) => delivery.status === 'delivered').length;
  const failed = deliveries.filter((delivery) => delivery.status === 'retry').length;
  logger.info('Push notifications sent', {
    userId: params.userId,
    sent: String(sent),
  });
  if (failed)
    logger.warn('Push notification deliveries failed', {
      userId: params.userId,
      failed: String(failed),
    });
  return { status: 'attempted', sent, failed, expired: expiredSubscriptions.length, deliveries };
}
