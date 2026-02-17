import { prisma } from './prisma';
import { notificationQueue, addJob, JobType } from './queue';
import type { SendNotificationPayload } from './queue';

export type ModerationActionType =
  | 'warn'
  | 'suspend'
  | 'ban'
  | 'unban'
  | 'unsuspend'
  | 'remove_content';

interface ModerationParams {
  userId: string;
  moderatorId: string;
  reason: string;
  metadata?: Record<string, unknown>;
}

interface SuspendParams extends ModerationParams {
  durationDays: number;
}

async function createModerationAction(
  action: ModerationActionType,
  params: ModerationParams
) {
  return prisma.moderationAction.create({
    data: {
      userId: params.userId,
      moderatorId: params.moderatorId,
      action,
      reason: params.reason,
      metadata: params.metadata ?? undefined,
    },
  });
}

function sendModerationNotification(
  userId: string,
  type: string,
  title: string,
  message: string
) {
  const payload: SendNotificationPayload = { userId, type, title, message };
  addJob(notificationQueue, JobType.SEND_NOTIFICATION, payload).catch(() => {});
}

export async function warnUser(params: ModerationParams) {
  await prisma.user.update({
    where: { id: params.userId },
    data: { warningCount: { increment: 1 } },
  });

  await createModerationAction('warn', params);

  sendModerationNotification(
    params.userId,
    'ACCOUNT_WARNING',
    'Account Warning',
    `You have received a warning: ${params.reason}`
  );
}

export async function suspendUser(params: SuspendParams) {
  const suspendedUntil = new Date();
  suspendedUntil.setDate(suspendedUntil.getDate() + params.durationDays);

  await prisma.user.update({
    where: { id: params.userId },
    data: {
      suspendedUntil,
      suspendedReason: params.reason,
    },
  });

  await createModerationAction('suspend', {
    ...params,
    metadata: { ...params.metadata, durationDays: params.durationDays },
  });

  sendModerationNotification(
    params.userId,
    'ACCOUNT_SUSPENDED',
    'Account Suspended',
    `Your account has been suspended for ${params.durationDays} day(s): ${params.reason}`
  );
}

export async function banUser(params: ModerationParams) {
  await prisma.user.update({
    where: { id: params.userId },
    data: {
      bannedAt: new Date(),
      bannedReason: params.reason,
    },
  });

  await createModerationAction('ban', params);

  sendModerationNotification(
    params.userId,
    'ACCOUNT_BANNED',
    'Account Banned',
    `Your account has been banned: ${params.reason}`
  );
}

export async function unbanUser(params: ModerationParams) {
  await prisma.user.update({
    where: { id: params.userId },
    data: {
      bannedAt: null,
      bannedReason: null,
    },
  });

  await createModerationAction('unban', params);
}

export async function unsuspendUser(params: ModerationParams) {
  await prisma.user.update({
    where: { id: params.userId },
    data: {
      suspendedUntil: null,
      suspendedReason: null,
    },
  });

  await createModerationAction('unsuspend', params);
}
