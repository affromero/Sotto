import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import type { OutboxJob } from 'thesidedoor-core/runtime/outbox';
import {
  durableEnvelopeSchema,
  validateDurableAuthority,
} from '@/lib/sidedoor/jobs/core/durable-queue';
import {
  durableNotificationSchema,
  validateDurableNotificationTarget,
} from '@/workers/durable/notifications/durable-notification';

export const genericNotificationPayloadSchema = z
  .object({
    notificationId: z.uuid(),
    userId: z.string().min(1).max(200),
    type: z.enum([
      'EPISODE_READY',
      'EPISODE_FAILED',
      'KEY_INVALID',
      'SCRIPT_READY',
      'PLATFORM_ANNOUNCEMENT',
      'PIPELINE_FAILURE',
    ]),
    title: z.string().min(1).max(300),
    message: z.string().min(1).max(20_000),
    data: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export type DurableNotificationMessage = z.infer<typeof genericNotificationPayloadSchema>;

/** Parse and reauthorize either durable notification admission contract. */
export async function readNotificationParent(
  database: Prisma.TransactionClient,
  parent: OutboxJob
): Promise<DurableNotificationMessage | null> {
  if (parent.job.version === 1) {
    const message = durableNotificationSchema.parse(parent.job.payload);
    if (!(await validateDurableNotificationTarget(database, message))) return null;
    return genericNotificationPayloadSchema.parse({
      notificationId: parent.job.id,
      userId: message.userId,
      type: message.type,
      title: message.title,
      message: message.message,
      data: message.data,
    });
  }
  if (parent.job.version !== 4) throw new Error('Unsupported durable notification parent');
  const envelope = durableEnvelopeSchema.parse(parent.job.payload);
  if (envelope.type !== 'send_notification')
    throw new Error('Durable notification operation type changed');
  const message = genericNotificationPayloadSchema.parse(envelope.payload);
  const recipient = await validateDurableAuthority(database, envelope.authority);
  if (!recipient || recipient.userId !== message.userId)
    throw new Error('Durable notification recipient changed');
  return message;
}
