import { logger } from './logger';
import { prisma } from './prisma';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT;

/**
 * Send a push notification to all of a user's registered devices
 */
export async function sendPushNotification(params: {
  userId: string;
  title: string;
  body: string;
  url?: string;
  data?: Record<string, string>;
}): Promise<void> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    logger.warn('VAPID keys and subject not configured — push notifications disabled');
    return;
  }

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId: params.userId },
  });

  if (subscriptions.length === 0) {
    logger.debug('No push subscriptions for user', { userId: params.userId });
    return;
  }

  // Dynamic import of web-push (only needed server-side)
  const webpush = await import('web-push');
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const payload = JSON.stringify({
    title: params.title,
    body: params.body,
    url: params.url || '/',
    data: params.data,
  });

  const results = await Promise.allSettled(
    subscriptions.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      )
    )
  );

  // Clean up expired subscriptions
  const expiredIds: string[] = [];
  results.forEach((result, index) => {
    if (result.status === 'rejected' && (result.reason as { statusCode?: number })?.statusCode === 410) {
      expiredIds.push(subscriptions[index].id);
    }
  });

  if (expiredIds.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: expiredIds } } });
    logger.info('Cleaned up expired push subscriptions', { count: String(expiredIds.length) });
  }

  logger.info('Push notifications sent', { userId: params.userId, sent: String(subscriptions.length - expiredIds.length) });
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Send Expo push notifications to all of a user's registered mobile devices
 */
export async function sendExpoPushNotification(params: {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}): Promise<void> {
  const tokens = await prisma.expoPushToken.findMany({
    where: { userId: params.userId },
  });

  if (tokens.length === 0) {
    return;
  }

  const messages = tokens.map((t) => ({
    to: t.token,
    sound: 'default' as const,
    title: params.title,
    body: params.body,
    data: params.data,
  }));

  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  });

  if (!response.ok) {
    logger.warn('Expo push notification failed', {
      status: String(response.status),
      userId: params.userId,
    });
    return;
  }

  const result = await response.json();
  const tickets = result.data as Array<{ status: string; details?: { error?: string }; id?: string }>;

  // Clean up invalid tokens (DeviceNotRegistered)
  const invalidTokenIds: string[] = [];
  tickets.forEach((ticket, index) => {
    if (
      ticket.status === 'error' &&
      ticket.details?.error === 'DeviceNotRegistered'
    ) {
      invalidTokenIds.push(tokens[index].id);
    }
  });

  if (invalidTokenIds.length > 0) {
    await prisma.expoPushToken.deleteMany({
      where: { id: { in: invalidTokenIds } },
    });
    logger.info('Cleaned up invalid Expo push tokens', {
      count: String(invalidTokenIds.length),
    });
  }

  logger.info('Expo push notifications sent', {
    userId: params.userId,
    sent: String(tokens.length - invalidTokenIds.length),
  });
}
