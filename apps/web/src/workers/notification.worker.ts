import { Job } from 'bullmq';
import { SendNotificationPayload } from '@/lib/queue';

export async function processNotification(job: Job<SendNotificationPayload>): Promise<void> {
  if (job.name === 'notifications.v3') {
    const { processDurableNotificationFanout } =
      await import('@/workers/durable/notifications/durable-notification-fanout');
    return processDurableNotificationFanout(job);
  }
  if (job.name === 'notifications.v1') {
    const { processDurableNotification } =
      await import('@/workers/durable/notifications/durable-notification');
    return processDurableNotification(job);
  }
  if (job.name === 'notifications.v2') {
    const { processDurableNotificationDelivery } =
      await import('@/workers/durable/notifications/durable-notification-delivery');
    return processDurableNotificationDelivery(job);
  }
  if (job.name === 'notifications.v4') {
    const { processDurableGenericNotification } =
      await import('@/workers/durable/notifications/durable-generic-notification');
    return processDurableGenericNotification(job);
  }
  throw new Error('Unsupported notification contract');
}
