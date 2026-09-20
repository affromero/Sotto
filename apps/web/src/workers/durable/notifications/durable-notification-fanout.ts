import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import type { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import {
  readSottoWorkerJob,
  sottoJobOutbox,
  sottoJobSnapshot,
} from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { completeErasedJob, readJobParent } from '@/lib/sidedoor/access/deletion/job-erasure';
import type { NotificationQueueReference } from '@/workers/durable/notifications/durable-notification';
import { readNotificationParent } from '@/workers/durable/notifications/notification-parent';

const payloadSchema = z
  .object({
    parentOperationId: z.uuid(),
    parentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    parentVersion: z.union([z.literal(1), z.literal(4)]),
    snapshotId: z.uuid(),
    page: z.number().int().nonnegative().safe(),
  })
  .strict();
const deviceSchema = z
  .object({ id: z.string().min(1).max(200), version: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();

async function readPage(tx: Prisma.TransactionClient, queued: NotificationQueueReference) {
  const work = await readSottoWorkerJob(tx, queued, {
    handler: 'notifications',
    version: 3,
    payload: payloadSchema,
  });
  if (work.complete) return work;
  if (work.payload.snapshotId !== work.payload.parentOperationId)
    throw new Error('Notification fan-out does not match its snapshot identity');
  const parent = await readJobParent(tx, work, {
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
    work.payload.snapshotId !== parent.job.id ||
    !isDeepStrictEqual(parent.job.scopes, work.scopes)
  )
    throw new Error('Notification fan-out parent does not match inbox admission');
  if (await completeErasedJob(tx, work)) return { complete: true as const };
  const message = await readNotificationParent(tx, parent);
  if (!message) {
    await sottoJobOutbox(tx).complete(work.operationId, work.fingerprint);
    return { complete: true as const };
  }
  const page = await sottoJobSnapshot(tx).read(
    work.payload.snapshotId,
    parent.fingerprint,
    work.payload.page
  );
  if (!page.items.length) throw new Error('Notification fan-out page is outside its snapshot');
  return {
    ...work,
    devices: page.items.map((item) => deviceSchema.parse(item)),
    next: page.next,
    notificationId: message.notificationId,
  };
}

export async function processDurableNotificationFanout(
  queued: NotificationQueueReference
): Promise<void> {
  const captured = await sottoTransaction(prisma, (tx) => readPage(tx, queued));
  if (captured.complete) return;
  const common = {
    namespace: SIDEDOOR_STATE_ID,
    handler: 'notifications',
    scopes: captured.scopes,
    delivery: { attempts: 5, priority: 0, availableAt: 0 },
  };
  const deliveries = captured.devices.map((device) =>
    prepareJob({
      ...common,
      version: 2,
      payload: {
        parentOperationId: captured.payload.parentOperationId,
        parentFingerprint: captured.payload.parentFingerprint,
        parentVersion: captured.payload.parentVersion,
        notificationId: captured.notificationId,
        channel: 'push',
        device,
      },
    })
  );
  const next =
    captured.next === null
      ? null
      : prepareJob({
          ...common,
          version: 3,
          payload: { ...captured.payload, page: captured.next },
        });
  await sottoTransaction(prisma, async (tx) => {
    const current = await readPage(tx, queued);
    if (current.complete) return;
    if (!isDeepStrictEqual(current, captured))
      throw new Error('Notification fan-out snapshot changed');
    const outbox = sottoJobOutbox(tx);
    if (!(await outbox.complete(captured.operationId, captured.fingerprint))) return;
    for (const delivery of deliveries) await outbox.enqueue(delivery);
    if (next) await outbox.enqueue(next);
  });
}
